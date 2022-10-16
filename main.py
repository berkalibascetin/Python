type= int(input("İşlem yapmak istediğiniz geometrik şekli giriniz.\n1.Kare\n2.Dikdörtgen\n3.Daire\n4.üçgen"))

if type == 1:
    print("Selected Square")
    # lütfen alanını ve çevresini ölçmek istediğimiz karenin kenar uzunluğunu
    # alta giriniz.Uygulanan işlem gösterilicerktir.Çevre üsteki sayı alan ise
    # alttaki sayıdır başlatmak için başlata tıklayınız.
    edge = int(input("Kenar uzunluğunu giriniz(cm):"))
    cevre = (edge * 4)
    alan = (edge ** 2)
    print("Karenin çevresi:" + str(cevre) + " cm")
    print("Karenin alanı:" + str(alan) + " cm2")
elif type == 2:
    # Dikdörtgen alan ve çevre hesaplamaları
    print("Dikdörtgen Seçildi")
    LongEdge = int(input("uzun kenarı giriniz(cm):"))
    ShortEdge = int(input("kısa kenarı giriniz(cm):"))
    cevre=LongEdge*2+ShortEdge*2
    alan=LongEdge*ShortEdge
    print("Dikdörtgenin çevresi:" + str(cevre) + " cm")
    print("dikdörtgenin alanı:" + str(alan) + " cm2")
elif type == 3:
    print("Daire Seçildi")
    pi=3.14
    Yaricap = int(input("yarıcapı giriniz(cm):"))
    cevre=pi*2*Yaricap
    alan=pi*Yaricap**2
    print("Dairenin cevresi:" + str(cevre) + " cm")
    print("Dairenin alanı:" + str(alan) + " cm2")
elif type== 4:
    print("üçgen seçildi")
    birincikenar = int(input("1. kenarı giriniz.(cm):"))
    ikincikenar = int(input("2. kenarı giriniz.(cm):"))
    üçüncükenar= int(input("1. kenarı giriniz.(cm):"))
    cevre=birincikenar+ ikincikenar+üçüncükenar
    print(cevre)
